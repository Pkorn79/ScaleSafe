import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { evidenceService } from '../services/evidence.service';
import { disengagementService } from '../services/disengagement.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

export const dashboardController = {
  /** GET /api/dashboard/overview — merchant dashboard summary */
  async overview(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      // Parallel queries for dashboard data
      const [
        offersResult,
        defenseResult,
        outcomesResult,
        evidenceCountResult,
      ] = await Promise.all([
        supabase.from('offers_mirror').select('id', { count: 'exact' }).eq('location_id', locationId).eq('active', true),
        supabase.from('defense_packets').select('id, status', { count: 'exact' }).eq('location_id', locationId),
        supabase.from('defense_outcomes').select('outcome, amount_saved').eq('outcome', 'won'),
        supabase.from('evidence_timeline').select('contact_id', { count: 'exact' }).eq('location_id', locationId),
      ]);

      // Calculate Total Value Saved
      const totalValueSaved = (outcomesResult.data || [])
        .reduce((sum, o) => sum + (o.amount_saved || 0), 0);

      // Defense stats
      const defensePackets = defenseResult.data || [];
      const defenseStats = {
        total: defensePackets.length,
        pending: defensePackets.filter(d => d.status === 'pending').length,
        processing: defensePackets.filter(d => d.status === 'processing').length,
        complete: defensePackets.filter(d => d.status === 'complete').length,
        failed: defensePackets.filter(d => d.status === 'failed').length,
      };

      // Unique active clients (distinct contact_ids with evidence)
      const uniqueContacts = new Set((evidenceCountResult.data || []).map(e => e.contact_id));

      res.json({
        activeOffers: offersResult.count || 0,
        activeClients: uniqueContacts.size,
        totalEvidenceRecords: evidenceCountResult.count || 0,
        defenseStats,
        totalValueSaved,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/at-risk — list at-risk clients */
  async atRisk(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const flagged = await disengagementService.checkAllClients(locationId);
      res.json({
        count: flagged.length,
        clients: flagged.map(c => ({
          contactId: c.contactId,
          riskScore: c.riskScore,
          riskFactors: c.riskFactors,
          daysInactive: c.daysInactive,
        })),
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/evidence-health — evidence completeness per client */
  async evidenceHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      // Get all contacts with evidence
      const { data: contacts } = await supabase
        .from('evidence_timeline')
        .select('contact_id')
        .eq('location_id', locationId);

      const uniqueIds = [...new Set((contacts || []).map(c => c.contact_id))];

      // Score each (limit to 50 for performance)
      const clientScores = [];
      for (const contactId of uniqueIds.slice(0, 50)) {
        const { score, breakdown } = await evidenceService.calculateReadinessScore(locationId, contactId);
        clientScores.push({ contactId, score, breakdown });
      }

      // Sort by score ascending (weakest first)
      clientScores.sort((a, b) => a.score - b.score);

      res.json({
        totalClients: uniqueIds.length,
        scores: clientScores,
        averageScore: clientScores.length > 0
          ? Math.round(clientScores.reduce((s, c) => s + c.score, 0) / clientScores.length)
          : 0,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/dashboard/defense-history — past chargebacks with outcomes */
  async defenseHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const supabase = getSupabase();

      const { data: packets } = await supabase
        .from('defense_packets')
        .select('id, contact_id, reason_code, reason_category, dispute_amount, dispute_date, deadline, status, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false });

      // Get outcomes for completed packets
      const packetIds = (packets || []).map(p => p.id);
      const { data: outcomes } = await supabase
        .from('defense_outcomes')
        .select('defense_packet_id, outcome, amount_saved, notes')
        .in('defense_packet_id', packetIds.length > 0 ? packetIds : ['_none_']);

      const outcomeMap = new Map((outcomes || []).map(o => [o.defense_packet_id, o]));

      const history = (packets || []).map(p => ({
        ...p,
        outcome: outcomeMap.get(p.id) || null,
      }));

      // Summary stats
      const won = (outcomes || []).filter(o => o.outcome === 'won');
      const lost = (outcomes || []).filter(o => o.outcome === 'lost');

      res.json({
        packets: history,
        summary: {
          total: history.length,
          won: won.length,
          lost: lost.length,
          pending: history.filter(h => !h.outcome && h.status === 'complete').length,
          totalValueSaved: won.reduce((s, o) => s + (o.amount_saved || 0), 0),
          winRate: won.length + lost.length > 0
            ? Math.round((won.length / (won.length + lost.length)) * 100)
            : 0,
        },
      });
    } catch (err) { next(err); }
  },
};

-- 006_seed_reason_codes.sql — Seed reason code strategies (v2.1)
--
-- Pre-populates the most common chargeback reason codes with
-- evidence priorities and defense strategy guidance for the AI compiler.

INSERT INTO reason_code_strategies (reason_code, network, category, display_name, description, evidence_priorities, strategy_guidance, historical_win_rate) VALUES

-- ============================================================
-- VISA REASON CODES
-- ============================================================
('10.1', 'visa', 'authorization',
 'EMV Liability Shift Counterfeit Fraud',
 'Cardholder claims they did not authorize the transaction.',
 '["consent", "ip_device_match", "undisputed_transactions"]',
 'Focus on consent capture evidence. Show IP/device at enrollment matches later usage. Hardest category to win — lean heavily on forensic consent data.',
 15.00),

('10.4', 'visa', 'fraud',
 'Other Fraud — Card-Absent Environment',
 'Cardholder claims they did not authorize or participate in the transaction.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Prove same person enrolled and used the service. Link enrollment IP/device to later platform logins. Show prior undisputed transactions. Include communication logs showing client engagement.',
 35.00),

('13.1', 'visa', 'services_not_provided',
 'Merchandise/Services Not Received',
 'Cardholder claims they did not receive the services they paid for.',
 '["sessions", "modules", "milestones", "service_access", "signoffs", "communication"]',
 'Itemize every service touchpoint with dates and details. Show session delivery logs, module completions, milestone sign-offs. Platform access logs prove the client actively used the service. Volume of delivery is the key argument.',
 55.00),

('13.3', 'visa', 'not_as_described',
 'Not As Described or Defective',
 'Cardholder claims the service was not as described or materially different from what was promised.',
 '["consent", "offer_terms", "enrollment_packet", "deliverables", "communication", "milestones"]',
 'Compare promised deliverables (from offer terms reviewed at enrollment) vs what was actually delivered. Show client reviewed and agreed to exact terms. Include T&C consent with hash proving exact terms agreed to. Milestone sign-offs show client acknowledged satisfactory delivery.',
 45.00),

('13.6', 'visa', 'credit_not_processed',
 'Credit Not Processed',
 'Cardholder claims a refund or credit was due but not received.',
 '["consent", "refund_policy", "cancellation", "communication", "payment_history"]',
 'Show refund policy from agreed T&C. Demonstrate merchant followed their stated policy. Include cancellation records and all related communication. If refund was outside policy window, prove policy was clearly presented.',
 50.00),

-- ============================================================
-- MASTERCARD REASON CODES
-- ============================================================
('4837', 'mastercard', 'fraud',
 'No Cardholder Authorization',
 'Cardholder denies authorizing or participating in the transaction.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Same strategy as Visa 10.4. Prove authorization through consent forensics (IP, device, browser, timestamp). Link to subsequent service usage from same device/IP. Prior undisputed payments are strongest evidence.',
 35.00),

('4853', 'mastercard', 'not_as_described',
 'Cardholder Dispute — Not As Described',
 'Cardholder claims goods or services were not as described.',
 '["consent", "offer_terms", "enrollment_packet", "deliverables", "communication", "milestones"]',
 'Same strategy as Visa 13.3. Focus on what was promised vs delivered. T&C consent hash proves exact terms. Milestone sign-offs prove client acknowledged work quality.',
 45.00),

('4855', 'mastercard', 'services_not_provided',
 'Goods or Services Not Provided',
 'Cardholder claims merchandise or services were not provided.',
 '["sessions", "modules", "milestones", "service_access", "signoffs", "communication"]',
 'Same strategy as Visa 13.1. Comprehensive delivery documentation is key. Every session, every module, every login, every communication — volume tells the story.',
 55.00),

('4860', 'mastercard', 'credit_not_processed',
 'Credit Not Processed',
 'Cardholder claims they are owed a credit/refund that was not provided.',
 '["consent", "refund_policy", "cancellation", "communication", "payment_history"]',
 'Same strategy as Visa 13.6. Refund policy consent is critical. Show all communication around the refund request.',
 50.00)

ON CONFLICT (reason_code, network) DO UPDATE SET
  category = EXCLUDED.category,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  evidence_priorities = EXCLUDED.evidence_priorities,
  strategy_guidance = EXCLUDED.strategy_guidance,
  historical_win_rate = EXCLUDED.historical_win_rate,
  updated_at = now();

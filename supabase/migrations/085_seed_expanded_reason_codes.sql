-- 085_seed_expanded_reason_codes.sql — Expanded reason-code strategies
--
-- Adds the reason codes missing from 006: Visa consumer-dispute family
-- (13.2/13.5/13.7), Visa authorization/processing codes, Mastercard
-- 4808/4834/4841, the Amex C/A/P/F families, and Discover. Mirrors
-- src/constants/reason-codes.ts (the code registry is the source of truth
-- for network/category; this table adds per-code evidence priorities and
-- strategy guidance for the AI compiler).
--
-- historical_win_rate is intentionally NULL for all new rows: we have no
-- outcome data for these codes yet and must not invent numbers.

INSERT INTO reason_code_strategies (reason_code, network, category, display_name, description, evidence_priorities, strategy_guidance, historical_win_rate) VALUES

-- ============================================================
-- VISA — consumer disputes (13.x additions)
-- ============================================================
('13.2', 'visa', 'canceled_recurring',
 'Canceled Recurring Transaction',
 'Cardholder claims they canceled the recurring payment before this charge.',
 '["cancellation", "consent", "service_access", "sessions", "communication"]',
 'The sequence of dates decides this. Lead with the cancellation ledger: either the documented absence of any cancellation request before the billing date, or the exact dates showing billing preceded the request. Show express consent to recurring billing from the signed terms. Per Visa (Oct 2024 update), usage of the service after the claimed withdrawal date and before the dispute date is admissible — cite access/session records in that window. If a cancellation request predates the charge, this is generally indefensible: recommend accepting.',
 NULL),

('13.5', 'visa', 'misrepresentation',
 'Misrepresentation',
 'Cardholder claims the terms of the sale were misrepresented.',
 '["consent", "offer_terms", "enrollment_packet", "communication", "payment_history"]',
 'Present the exact terms shown and accepted at enrollment (T&C version hash proves the version). Disclosure of the payment schedule is central: show the cardholder expressly agreed to future transactions. For trial/promotional conversions Visa expects advance notice of the upcoming charge at least 7 days before billing — include notice records if they exist, and flag their absence.',
 NULL),

('13.7', 'visa', 'canceled_services',
 'Canceled Merchandise/Services',
 'Cardholder claims they canceled the merchandise or services.',
 '["cancellation", "consent", "offer_terms", "service_access", "communication"]',
 'Show the cancellation policy as disclosed and accepted at enrollment, and whether the cardholder actually canceled per that policy. Continued usage after the claimed cancellation contradicts the claim — cite access records with dates.',
 NULL),

-- ============================================================
-- VISA — authorization / processing errors
-- ============================================================
('11.1', 'visa', 'authorization',
 'Card Recovery Bulletin',
 'Transaction processed against a listed card without authorization.',
 '["payment_history", "consent"]',
 'Authorization-family disputes turn on processor records: provide the authorization approval code and date. If no valid authorization exists, this is generally not defensible on the merits.',
 NULL),

('11.2', 'visa', 'authorization',
 'Declined Authorization',
 'Transaction completed after the authorization was declined.',
 '["payment_history", "consent"]',
 'Provide processor authorization logs showing an approval for the disputed amount. If the authorization was in fact declined, recommend accepting.',
 NULL),

('11.3', 'visa', 'authorization',
 'No Authorization',
 'Transaction processed without authorization or after authorization expired.',
 '["payment_history", "consent"]',
 'Provide the authorization approval code, amount, and date from processor records, showing the charge matched what was authorized.',
 NULL),

('12.5', 'visa', 'duplicate_processing',
 'Incorrect Amount',
 'Cardholder claims the billed amount is incorrect.',
 '["payment_history", "consent", "offer_terms", "enrollment_packet"]',
 'Show the amount agreed at enrollment (signed packet payment schedule) matches the amount billed. Cite the specific installment or invoice the charge corresponds to.',
 NULL),

('12.6.1', 'visa', 'duplicate_processing',
 'Duplicate Processing',
 'Cardholder claims a single transaction was processed more than once.',
 '["payment_history", "offer_terms", "communication"]',
 'Prove each charge is a distinct obligation: separate installments, separate offers, or one authorization hold vs one settlement. Cite transaction IDs, amounts, and dates for each charge separately.',
 NULL),

('12.6.2', 'visa', 'duplicate_processing',
 'Paid by Other Means',
 'Cardholder claims they paid for the same goods/services by another method.',
 '["payment_history", "offer_terms", "communication"]',
 'Show sales records demonstrating the card charge was the only payment for this obligation, or that the two payments covered distinct obligations.',
 NULL),

-- ============================================================
-- MASTERCARD additions
-- ============================================================
('4808', 'mastercard', 'authorization',
 'Authorization-Related Chargeback',
 'Transaction processed without valid authorization.',
 '["payment_history", "consent"]',
 'Provide processor authorization logs and approval codes showing valid authorization for the disputed amount.',
 NULL),

('4834', 'mastercard', 'duplicate_processing',
 'Point-of-Interaction Error',
 'Duplicate processing or other point-of-interaction error.',
 '["payment_history", "offer_terms", "communication"]',
 'Prove each charge is a distinct obligation with separate transaction IDs, amounts, and dates. For installment plans, show the charge is the scheduled installment (correct number, correct amount, not premature).',
 NULL),

('4841', 'mastercard', 'canceled_recurring',
 'Canceled Recurring or Digital Goods',
 'Cardholder claims a recurring transaction was canceled before billing.',
 '["cancellation", "consent", "service_access", "sessions", "communication"]',
 'Same approach as Visa 13.2 — the date sequence decides it. Mastercard additionally recognizes the installment defense: if the arrangement was a fixed installment plan rather than an open-ended subscription, state that and cite the signed payment schedule. Show any usage after the claimed cancellation date. Billing after a received cancellation request is generally indefensible: recommend accepting.',
 NULL),

-- ============================================================
-- AMERICAN EXPRESS
-- ============================================================
('A01', 'amex', 'authorization',
 'Charge Amount Exceeds Authorization',
 'The charge exceeds the authorized amount.',
 '["payment_history", "consent"]',
 'Provide authorization records showing the approved amount matches the charge.',
 NULL),

('A02', 'amex', 'authorization',
 'No Valid Authorization',
 'The charge was processed without valid authorization.',
 '["payment_history", "consent"]',
 'Provide the authorization approval code and date from processor records.',
 NULL),

('A08', 'amex', 'authorization',
 'Authorization Approval Expired',
 'The charge settled after the authorization expired.',
 '["payment_history", "consent"]',
 'Provide authorization and settlement timestamps showing settlement within the approval window.',
 NULL),

('C02', 'amex', 'credit_not_processed',
 'Credit Not Processed',
 'Cardmember claims a credit was due but not received.',
 '["refund_policy", "cancellation", "consent", "communication", "payment_history"]',
 'If a refund was issued, lead with the refund transaction record (amount and date). If no refund was due, show the refund policy accepted at enrollment and why the request fell outside it.',
 NULL),

('C04', 'amex', 'credit_not_processed',
 'Goods/Services Returned or Refused',
 'Cardmember claims goods/services were returned or refused.',
 '["refund_policy", "cancellation", "service_access", "communication"]',
 'For services, "return" usually means a cancellation claim: show the cancellation policy, whether it was followed, and any continued usage after the claimed refusal.',
 NULL),

('C05', 'amex', 'canceled_services',
 'Goods/Services Canceled',
 'Cardmember claims the goods/services were canceled.',
 '["cancellation", "consent", "offer_terms", "service_access", "communication"]',
 'Show the cancellation policy as accepted, whether the cardmember canceled per policy, and any usage after the claimed cancellation date.',
 NULL),

('C08', 'amex', 'services_not_provided',
 'Goods/Services Not Received',
 'Cardmember claims goods/services were not received.',
 '["sessions", "modules", "milestones", "service_access", "signoffs", "communication"]',
 'Itemize delivery with dates: sessions attended, milestones signed off, portal access. Amex digital-goods responses benefit from IP-matched access evidence — include access records that tie usage to the cardmember identity.',
 NULL),

('C14', 'amex', 'duplicate_processing',
 'Paid by Other Means',
 'Cardmember claims payment was made by other means.',
 '["payment_history", "offer_terms", "communication"]',
 'Show the card charge was the only payment for this obligation, or that multiple payments covered distinct obligations.',
 NULL),

('C28', 'amex', 'canceled_recurring',
 'Canceled Recurring Billing',
 'Cardmember claims recurring billing was canceled before the charge.',
 '["cancellation", "consent", "service_access", "sessions", "communication"]',
 'Lead with the subscription agreement and auto-renewal consent, the cancellation policy, proof of non-cancellation (or the date sequence), and usage after the charge. Billing after a received cancellation request is generally indefensible: recommend accepting.',
 NULL),

('C31', 'amex', 'not_as_described',
 'Goods/Services Not As Described',
 'Cardmember claims goods/services differ from what was described.',
 '["consent", "offer_terms", "enrollment_packet", "deliverables", "communication", "milestones"]',
 'Compare the written description at purchase (signed enrollment terms) against what was delivered. Milestone signoffs and positive progress confirmations rebut the claim directly.',
 NULL),

('C32', 'amex', 'not_as_described',
 'Goods/Services Damaged or Defective',
 'Cardmember claims goods/services were damaged or defective.',
 '["consent", "offer_terms", "deliverables", "communication", "milestones"]',
 'For services, address the specific quality claim with delivery records and any acceptance/signoff. Include remedy offers from support threads if they exist.',
 NULL),

('F29', 'amex', 'fraud',
 'Card Not Present Fraud',
 'Cardmember denies authorizing a card-not-present charge.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Same approach as Visa 10.4: consent forensics (IP, device, timestamp, signature) linked to subsequent service usage by the same identity. Prior undisputed payments on the same card strengthen the response.',
 NULL),

('P08', 'amex', 'duplicate_processing',
 'Duplicate Charge',
 'The same charge appears to have been processed more than once.',
 '["payment_history", "offer_terms"]',
 'Prove each charge is distinct: transaction IDs, amounts, dates, and what each paid for.',
 NULL),

('FR2', 'amex', 'fraud',
 'Fraud Full Recourse Program',
 'Charge disputed under the Amex Fraud Full Recourse program.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Full-recourse fraud disputes are hard to reverse; respond with consent forensics linked to service usage by the same identity. Set merchant expectations accordingly.',
 NULL),

('FR6', 'amex', 'fraud',
 'Partial Immediate Chargeback Program',
 'Charge disputed under the Amex Partial Immediate Chargeback program.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Same evidence approach as F29: consent forensics plus identity-linked usage and prior undisputed transactions.',
 NULL),

-- ============================================================
-- DISCOVER
-- ============================================================
('AA', 'discover', 'fraud',
 'Does Not Recognize',
 'Cardholder does not recognize the transaction.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Identity linkage wins this: show who enrolled (consent forensics), that the descriptor matches the merchant, and that the cardholder used the service. Often resolvable by clear documentation of what the charge was for.',
 NULL),

('AP', 'discover', 'canceled_recurring',
 'Canceled Recurring Payment',
 'Cardholder claims the recurring payment was canceled.',
 '["cancellation", "consent", "service_access", "sessions", "communication"]',
 'Subscription authorization and the cancellation-date sequence decide this. Show express consent to recurring billing and any usage after the claimed cancellation. Billing after a received cancellation request is generally indefensible: recommend accepting.',
 NULL),

('RG', 'discover', 'services_not_provided',
 'Non-Receipt of Goods/Services',
 'Cardholder claims goods/services were not received.',
 '["sessions", "modules", "milestones", "service_access", "signoffs", "communication"]',
 'Proof of service completion with dates: sessions, milestones, portal access. For digital delivery include email/IP and date/time of access tied to the cardholder.',
 NULL),

('RM', 'discover', 'not_as_described',
 'Cardholder Disputes Quality',
 'Cardholder disputes the quality of goods/services.',
 '["consent", "offer_terms", "deliverables", "communication", "milestones"]',
 'Compare the accepted scope against what was delivered; cite signoffs and progress confirmations. Address the specific quality claim factually.',
 NULL),

('RN2', 'discover', 'credit_not_processed',
 'Credit Not Received',
 'Cardholder claims a promised credit was not received.',
 '["refund_policy", "cancellation", "consent", "communication", "payment_history"]',
 'If a refund was issued, lead with the refund record. If none was due, show the accepted refund policy and why the request fell outside it.',
 NULL),

('UA', 'discover', 'fraud',
 'Fraud — Card Not Present',
 'Cardholder denies authorizing a card-not-present charge.',
 '["consent", "ip_device_match", "service_access", "communication", "undisputed_transactions"]',
 'Same approach as Visa 10.4: consent forensics linked to service usage by the same identity, plus prior undisputed transactions.',
 NULL)

ON CONFLICT (reason_code, network) DO UPDATE SET
  category = EXCLUDED.category,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  evidence_priorities = EXCLUDED.evidence_priorities,
  strategy_guidance = EXCLUDED.strategy_guidance,
  updated_at = now();

-- =====================================================================
-- Flowstate CRM — Ansprechperson (Migration 0008)
-- Der Firmenname steht in der Liste (z. B. "Krankengymnastik GmbH). In der Akte
-- brauchen wir zusaetzlich, MIT WEM wir dort sprechen. Der Name liegt schon in
-- geschaeftsfuehrer (Migration 0006) — hier kommt nur die Position dazu.
-- =====================================================================

alter table public.firmen add column if not exists ansprech_rolle text;

-- Run as the database owner. This schema is deliberately NOT exposed through PostgREST.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trustlayer_server') THEN
    CREATE ROLE trustlayer_server NOLOGIN;
  ELSIF EXISTS (SELECT FROM pg_roles WHERE rolname = 'trustlayer_server' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'trustlayer_server must be an unprivileged NOLOGIN role';
  END IF;
END $$;
CREATE SCHEMA trustlayer;
REVOKE ALL ON SCHEMA trustlayer FROM PUBLIC;
GRANT USAGE ON SCHEMA trustlayer TO trustlayer_server;

CREATE DOMAIN trustlayer.wallet AS text CHECK (VALUE ~ '^0x[0-9a-f]{40}$' AND VALUE <> '0x0000000000000000000000000000000000000000');
CREATE DOMAIN trustlayer.uint256 AS numeric CHECK (VALUE = trunc(VALUE) AND VALUE >= 0 AND VALUE <= 115792089237316195423570985008687907853269984665640564039457584007913129639935);
CREATE DOMAIN trustlayer.hash AS text CHECK (VALUE ~ '^0x[0-9a-f]{64}$');

CREATE TABLE trustlayer.profiles (
  wallet_address trustlayer.wallet PRIMARY KEY,
  display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 80),
  biography text NOT NULL DEFAULT '' CHECK (length(biography) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A local chain can restart with the same chain ID AND contract addresses.
CREATE TABLE trustlayer.deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  escrow_address trustlayer.wallet NOT NULL,
  arbitration_address trustlayer.wallet NOT NULL,
  anchor_hash trustlayer.hash NOT NULL,
  anchor_number trustlayer.uint256 NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, escrow_address, anchor_hash),
  UNIQUE (id, chain_id, arbitration_address)
);
CREATE TABLE trustlayer.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES trustlayer.deployments(id),
  onchain_project_id trustlayer.uint256 NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  client_wallet trustlayer.wallet NOT NULL,
  freelancer_wallet trustlayer.wallet NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_wallet <> freelancer_wallet),
  UNIQUE (deployment_id, onchain_project_id),
  UNIQUE (id, deployment_id)
);
CREATE INDEX projects_client ON trustlayer.projects(client_wallet);
CREATE INDEX projects_freelancer ON trustlayer.projects(freelancer_wallet);
CREATE TABLE trustlayer.milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES trustlayer.projects(id),
  onchain_index smallint NOT NULL CHECK (onchain_index BETWEEN 0 AND 4),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, onchain_index),
  UNIQUE (id, project_id)
);
CREATE TABLE trustlayer.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES trustlayer.milestones(id),
  content_reference text NOT NULL CHECK (length(btrim(content_reference)) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submissions_milestone ON trustlayer.submissions(milestone_id);
CREATE TABLE trustlayer.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL,
  chain_id bigint NOT NULL,
  arbitration_address trustlayer.wallet NOT NULL,
  onchain_dispute_id trustlayer.uint256 NOT NULL,
  project_id uuid NOT NULL,
  milestone_id uuid NOT NULL,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (deployment_id, chain_id, arbitration_address) REFERENCES trustlayer.deployments(id, chain_id, arbitration_address),
  FOREIGN KEY (project_id, deployment_id) REFERENCES trustlayer.projects(id, deployment_id),
  FOREIGN KEY (milestone_id, project_id) REFERENCES trustlayer.milestones(id, project_id),
  UNIQUE (deployment_id, onchain_dispute_id),
  UNIQUE (milestone_id)
);
CREATE INDEX disputes_project ON trustlayer.disputes(project_id);

CREATE TABLE trustlayer.auth_nonces (
  challenge_hash text PRIMARY KEY CHECK (challenge_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  wallet_address trustlayer.wallet NOT NULL,
  message text NOT NULL CHECK (length(message) <= 2048),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > issued_at)
);
CREATE INDEX auth_nonces_expiry ON trustlayer.auth_nonces(expires_at);
CREATE TABLE trustlayer.auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  wallet_address trustlayer.wallet NOT NULL REFERENCES trustlayer.profiles(wallet_address),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_expiry ON trustlayer.auth_sessions(expires_at);
CREATE TABLE trustlayer.auth_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);

CREATE FUNCTION trustlayer.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER profiles_updated BEFORE UPDATE ON trustlayer.profiles FOR EACH ROW EXECUTE FUNCTION trustlayer.touch_updated_at();
CREATE TRIGGER projects_updated BEFORE UPDATE ON trustlayer.projects FOR EACH ROW EXECUTE FUNCTION trustlayer.touch_updated_at();
CREATE TRIGGER milestones_updated BEFORE UPDATE ON trustlayer.milestones FOR EACH ROW EXECUTE FUNCTION trustlayer.touch_updated_at();
REVOKE ALL ON FUNCTION trustlayer.touch_updated_at() FROM PUBLIC;

-- Custom SIWE cookies are NOT Supabase Auth JWTs. Only the server role can use
-- these tables; all wallet/contract authorization happens in route services.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','deployments','projects','milestones','submissions','disputes','auth_nonces','auth_sessions','auth_rate_limits'] LOOP
    EXECUTE format('ALTER TABLE trustlayer.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY server_only ON trustlayer.%I FOR ALL TO trustlayer_server USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON trustlayer.%I TO trustlayer_server', t);
    EXECUTE format('REVOKE ALL ON trustlayer.%I FROM PUBLIC', t);
  END LOOP;
END $$;

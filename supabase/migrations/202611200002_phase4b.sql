-- Additive: preserve the applied Phase 4A migration and all existing rows.
ALTER TABLE trustlayer.projects ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE trustlayer.projects ADD COLUMN sync_hash trustlayer.hash;
ALTER TABLE trustlayer.milestones ADD COLUMN name text NOT NULL DEFAULT '' CHECK (length(name) <= 160);

CREATE TABLE trustlayer.files (
  id uuid PRIMARY KEY,
  deployment_id uuid NOT NULL REFERENCES trustlayer.deployments(id),
  project_id trustlayer.uint256 NOT NULL,
  milestone_index smallint NOT NULL CHECK (milestone_index BETWEEN 0 AND 4),
  dispute_id trustlayer.uint256,
  category text NOT NULL CHECK (category IN ('deliverable','opening','response','evidence')),
  uploader trustlayer.wallet NOT NULL,
  idempotency_key uuid NOT NULL,
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 120 AND filename !~ '[/\\]'),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf','image/png','image/jpeg','text/plain')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  content_hash trustlayer.hash NOT NULL,
  bucket text NOT NULL,
  object_path text NOT NULL UNIQUE CHECK (object_path ~ '^v1/[a-f0-9-]{36}/[a-f0-9-]{36}$'),
  status text NOT NULL CHECK (status IN ('uploading','ready','linked','failed','deleting','deleted')),
  transaction_hash trustlayer.hash,
  confirmed_block trustlayer.uint256,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_chain_time bigint NOT NULL,
  UNIQUE (uploader,idempotency_key),
  CHECK ((category IN ('response','evidence')) = (dispute_id IS NOT NULL) OR category='opening'),
  CHECK (status <> 'linked' OR category='evidence' OR transaction_hash IS NOT NULL)
);
CREATE INDEX files_project ON trustlayer.files(deployment_id,project_id,milestone_index);
CREATE INDEX files_dispute ON trustlayer.files(deployment_id,dispute_id);
CREATE UNIQUE INDEX files_one_chain_reference ON trustlayer.files(deployment_id,project_id,milestone_index,category,COALESCE(dispute_id,-1)) WHERE status='linked' AND category<>'evidence';
CREATE TABLE trustlayer.file_access (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES trustlayer.files(id),
  wallet_address trustlayer.wallet NOT NULL,
  integrity_verified boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_access_file ON trustlayer.file_access(file_id);

-- Uploaded bytes/identity are immutable. Linked evidence cannot be edited/deleted
-- through the application role, even after a case has closed.
CREATE FUNCTION trustlayer.protect_file() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'File audit records are retained'; END IF;
  IF OLD.status='linked' OR ROW(NEW.id,NEW.deployment_id,NEW.project_id,NEW.milestone_index,NEW.category,NEW.uploader,NEW.idempotency_key,NEW.filename,NEW.media_type,NEW.byte_size,NEW.content_hash,NEW.bucket,NEW.object_path,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.deployment_id,OLD.project_id,OLD.milestone_index,OLD.category,OLD.uploader,OLD.idempotency_key,OLD.filename,OLD.media_type,OLD.byte_size,OLD.content_hash,OLD.bucket,OLD.object_path,OLD.created_at) THEN
    RAISE EXCEPTION 'Immutable file record';
  END IF;
  IF NEW.dispute_id IS DISTINCT FROM OLD.dispute_id AND NOT (OLD.category='opening' AND OLD.dispute_id IS NULL AND NEW.status='linked') THEN RAISE EXCEPTION 'Invalid case binding'; END IF;
  NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER files_immutable BEFORE UPDATE OR DELETE ON trustlayer.files FOR EACH ROW EXECUTE FUNCTION trustlayer.protect_file();
REVOKE ALL ON FUNCTION trustlayer.protect_file() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['files','file_access'] LOOP
    EXECUTE format('ALTER TABLE trustlayer.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY server_only ON trustlayer.%I FOR ALL TO trustlayer_server USING (true) WITH CHECK (true)',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON trustlayer.%I TO trustlayer_server',t);
    EXECUTE format('REVOKE ALL ON trustlayer.%I FROM PUBLIC',t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE trustlayer.file_access_id_seq TO trustlayer_server;

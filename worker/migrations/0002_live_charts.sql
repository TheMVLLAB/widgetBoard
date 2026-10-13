-- Snapshot consent does not authorize publishing future Notion changes.
UPDATE widgets SET visibility = 'private' WHERE visibility = 'public';
ALTER TABLE widgets DROP COLUMN snapshot_json;
ALTER TABLE widgets DROP COLUMN snapshot_at;

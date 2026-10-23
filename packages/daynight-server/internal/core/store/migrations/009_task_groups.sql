ALTER TABLE tasks ADD COLUMN group_id uuid;

WITH RECURSIVE members(project_id, task_id, root_id) AS (
    SELECT t.project_id, t.id, t.id FROM tasks t
    WHERE NOT EXISTS (
        SELECT 1 FROM task_dependencies d
        WHERE d.project_id = t.project_id AND d.task_id = t.id
    )
    UNION
    SELECT m.project_id, d.task_id, m.root_id
    FROM members m JOIN task_dependencies d
        ON d.project_id = m.project_id AND d.depends_on_task_id = m.task_id
), chosen AS (
    SELECT DISTINCT ON (m.project_id, m.task_id)
        m.project_id, m.task_id, m.root_id
    FROM members m JOIN tasks root
        ON root.project_id = m.project_id AND root.id = m.root_id
    ORDER BY m.project_id, m.task_id, root.created_at DESC, root.id DESC
)
UPDATE tasks t SET group_id = chosen.root_id
FROM chosen WHERE t.project_id = chosen.project_id AND t.id = chosen.task_id;

ALTER TABLE tasks ALTER COLUMN group_id SET NOT NULL;
CREATE INDEX tasks_project_group ON tasks (project_id, group_id);

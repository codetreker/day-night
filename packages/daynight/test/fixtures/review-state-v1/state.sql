-- Persisted rows use schema v1 from a476af983a1bb0e6cfb1ebc54214888744bea7dc.
-- Named parameters make filesystem values portable without current store code.
INSERT INTO repositories VALUES (
  'github.com', '4242', 'https://github.com/fixture/review-project.git', @repositoryPath,
  10, 1792411200000, 1792411200000, NULL
);
INSERT INTO pull_requests VALUES
  ('github.com', '4242', 17, 'open', 0, 'completed-head', 'main', 'base-head', 2, 2,
   '11111111-1111-4111-8111-111111111111', 1, @worktreePath, 0, NULL, 1792411200000),
  ('github.com', '4242', 18, 'open', 1, 'draft-head', 'main', 'base-head', 1, 0,
   NULL, 0, NULL, 0, NULL, 1792411200000),
  ('github.com', '4242', 19, 'closed', 0, 'closed-head', 'main', 'base-head', 1, 1,
   '22222222-2222-4222-8222-222222222222', 1, NULL, 0, NULL, 1792411200000),
  ('github.com', '4242', 20, 'open', 0, 'retry-head', 'release', 'base-head', 1, 0,
   '33333333-3333-4333-8333-333333333333', 1, NULL, 0, NULL, 1792411200000);
INSERT INTO reviews VALUES
  ('44444444-4444-4444-8444-444444444444', 'github.com', '4242', 17, 2,
   'completed-head', 'main', 'base-head', 'completed', 1, 3, NULL,
   NULL, NULL, NULL, @stdoutLogPath, @stderrLogPath, NULL, 1792411200000, 1792411200000),
  ('55555555-5555-4555-8555-555555555555', 'github.com', '4242', 19, 1,
   'closed-head', 'main', 'base-head', 'completed', 1, 3, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL, 1792411200000, 1792411200000),
  ('66666666-6666-4666-8666-666666666666', 'github.com', '4242', 20, 1,
   'retry-head', 'release', 'base-head', 'retry_wait', 2, 3, 1792411230000,
   NULL, NULL, NULL, NULL, NULL, 'Fixture agent interrupted', 1792411200000, 1792411200000);

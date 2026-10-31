reset (1000 + (reset ((capture (\k -> 100 + (reset (k 1)))) +
  (capture (\k -> 999))
)))

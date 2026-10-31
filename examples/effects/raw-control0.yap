reset (1000 + (reset ((capture (\k -> 100 + (k 1))) +
  (capture (\k -> 999))
)))

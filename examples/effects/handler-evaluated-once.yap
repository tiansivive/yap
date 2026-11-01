with Tick: (\count k -> count + (k !)) in
  with Echo: ({
    capture [Tick] 1;
    return \payload k -> k payload;
  }) in
    (capture [Echo] 20) + (capture [Echo] 21)

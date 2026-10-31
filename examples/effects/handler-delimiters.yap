{
  let outside = reset (1000 + (reset (10 + (capture (\k -> capture (\outer -> 100))))));
  let inside = reset (1000 + (reset (10 + (capture (\k -> reset (capture (\inner -> 100)))))));
  return { outside: outside, inside: inside };
}

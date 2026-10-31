{
  let rectangle: { width: Num, height: Num, area: Num } = {
    width: 6,
    height: 7,
    area: $width * $height
  };
  let point = { x: 10, y: 20 };
  let moved = { point | x = 42, z = 30 };
  return { area: rectangle.area, point: moved };
}

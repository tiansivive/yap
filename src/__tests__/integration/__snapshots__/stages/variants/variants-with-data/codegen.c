## Shape (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_alloc_record(0);
  YapValue v1 = Num;
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "1", v1);
  yap_record_set(&v2, "0", v1);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "point", v0);
  yap_record_set(&v3, "rectangle", v2);
  yap_record_set(&v3, "circle", v1);
  return v3;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## c (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("circle");
  YapValue v1 = yap_num(5);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "__tag", v0);
  yap_record_set(&v2, "payload", v1);
  return v2;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## r (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("rectangle");
  YapValue v1 = yap_num(10);
  YapValue v2 = yap_num(20);
  YapValue v3 = yap_alloc_record(2);
  yap_record_set(&v3, "0", v1);
  yap_record_set(&v3, "1", v2);
  YapValue v4 = yap_alloc_record(2);
  yap_record_set(&v4, "__tag", v0);
  yap_record_set(&v4, "payload", v3);
  return v4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## p (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("point");
  YapValue v1 = yap_num(0);
  YapValue v2 = yap_num(0);
  YapValue v3 = yap_alloc_record(2);
  yap_record_set(&v3, "x", v1);
  yap_record_set(&v3, "y", v2);
  YapValue v4 = yap_alloc_record(2);
  yap_record_set(&v4, "__tag", v0);
  yap_record_set(&v4, "payload", v3);
  return v4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

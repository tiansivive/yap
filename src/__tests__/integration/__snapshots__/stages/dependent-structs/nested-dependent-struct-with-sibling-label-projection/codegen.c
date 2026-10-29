## (expr) (expression)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(1);
  YapValue v1 = yap_num(2);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "x", v0);
  yap_record_set(&v2, "y", v1);
  YapValue v3 = yap_record_get(v2, "x");
  YapValue v4 = yap_num(2);
  YapValue v5 = yap_div(v3, v4);
  YapValue v6 = yap_record_get(v2, "y");
  YapValue v7 = yap_num(2);
  YapValue v8 = yap_div(v6, v7);
  YapValue v9 = yap_alloc_record(2);
  yap_record_set(&v9, "a", v5);
  yap_record_set(&v9, "b", v8);
  YapValue v10 = yap_alloc_record(2);
  yap_record_set(&v10, "point", v2);
  yap_record_set(&v10, "halved", v9);
  return v10;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

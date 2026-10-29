## rectangle (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(10);
  YapValue v1 = yap_num(20);
  YapValue v2 = yap_mul(v0, v1);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "width", v0);
  yap_record_set(&v3, "height", v1);
  yap_record_set(&v3, "area", v2);
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

## array (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(1);
  YapValue v1 = yap_num(2);
  YapValue v2 = yap_num(3);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "0", v0);
  yap_record_set(&v3, "1", v1);
  yap_record_set(&v3, "2", v2);
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

## dict (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(3);
  YapValue v1 = yap_num(2);
  YapValue v2 = yap_num(1);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "three", v0);
  yap_record_set(&v3, "two", v1);
  yap_record_set(&v3, "one", v2);
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

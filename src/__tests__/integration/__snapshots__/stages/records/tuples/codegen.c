## pair (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(42);
  YapValue v1 = yap_str("answer");
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "0", v0);
  yap_record_set(&v2, "1", v1);
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

## pairExplicit (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(42);
  YapValue v1 = yap_str("answer");
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "0", v0);
  yap_record_set(&v2, "1", v1);
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

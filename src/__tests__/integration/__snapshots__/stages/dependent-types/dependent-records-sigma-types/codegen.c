## DependentPair (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_alloc_record(0);
  return v0;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## numPair (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = Num;
  YapValue v1 = yap_num(42);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "fst", v0);
  yap_record_set(&v2, "snd", v1);
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

## strPair (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = String;
  YapValue v1 = yap_str("hello");
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "fst", v0);
  yap_record_set(&v2, "snd", v1);
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

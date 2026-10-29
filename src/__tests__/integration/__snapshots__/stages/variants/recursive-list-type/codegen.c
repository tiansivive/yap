## List (let)
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

## xs (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("cons");
  YapValue v1 = yap_num(1);
  YapValue v2 = yap_atom("cons");
  YapValue v3 = yap_num(2);
  YapValue v4 = yap_atom("nil");
  YapValue v5 = yap_null();
  YapValue v6 = yap_alloc_record(2);
  yap_record_set(&v6, "__tag", v4);
  yap_record_set(&v6, "payload", v5);
  YapValue v7 = yap_alloc_record(2);
  yap_record_set(&v7, "head", v3);
  yap_record_set(&v7, "tail", v6);
  YapValue v8 = yap_alloc_record(2);
  yap_record_set(&v8, "__tag", v2);
  yap_record_set(&v8, "payload", v7);
  YapValue v9 = yap_alloc_record(2);
  yap_record_set(&v9, "head", v1);
  yap_record_set(&v9, "tail", v8);
  YapValue v10 = yap_alloc_record(2);
  yap_record_set(&v10, "__tag", v0);
  yap_record_set(&v10, "payload", v9);
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

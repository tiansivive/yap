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

## empty (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("nil");
  YapValue v1 = yap_null();
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

## listOf1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("cons");
  YapValue v1 = yap_num(1);
  YapValue v2 = yap_atom("nil");
  YapValue v3 = yap_null();
  YapValue v4 = yap_alloc_record(2);
  yap_record_set(&v4, "__tag", v2);
  yap_record_set(&v4, "payload", v3);
  YapValue v5 = yap_alloc_record(2);
  yap_record_set(&v5, "0", v1);
  yap_record_set(&v5, "1", v4);
  YapValue v6 = yap_alloc_record(2);
  yap_record_set(&v6, "__tag", v0);
  yap_record_set(&v6, "payload", v5);
  return v6;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## listOf3 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("cons");
  YapValue v1 = yap_num(1);
  YapValue v2 = yap_atom("cons");
  YapValue v3 = yap_num(2);
  YapValue v4 = yap_atom("cons");
  YapValue v5 = yap_num(3);
  YapValue v6 = yap_atom("nil");
  YapValue v7 = yap_null();
  YapValue v8 = yap_alloc_record(2);
  yap_record_set(&v8, "__tag", v6);
  yap_record_set(&v8, "payload", v7);
  YapValue v9 = yap_alloc_record(2);
  yap_record_set(&v9, "0", v5);
  yap_record_set(&v9, "1", v8);
  YapValue v10 = yap_alloc_record(2);
  yap_record_set(&v10, "__tag", v4);
  yap_record_set(&v10, "payload", v9);
  YapValue v11 = yap_alloc_record(2);
  yap_record_set(&v11, "0", v3);
  yap_record_set(&v11, "1", v10);
  YapValue v12 = yap_alloc_record(2);
  yap_record_set(&v12, "__tag", v2);
  yap_record_set(&v12, "payload", v11);
  YapValue v13 = yap_alloc_record(2);
  yap_record_set(&v13, "0", v1);
  yap_record_set(&v13, "1", v12);
  YapValue v14 = yap_alloc_record(2);
  yap_record_set(&v14, "__tag", v0);
  yap_record_set(&v14, "payload", v13);
  return v14;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

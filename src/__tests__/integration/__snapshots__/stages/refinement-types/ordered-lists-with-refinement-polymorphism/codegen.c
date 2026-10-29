## OrderedList (let)
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

## ascending (let)
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
  yap_record_set(&v9, "head", v5);
  yap_record_set(&v9, "tail", v8);
  YapValue v10 = yap_alloc_record(2);
  yap_record_set(&v10, "__tag", v4);
  yap_record_set(&v10, "payload", v9);
  YapValue v11 = yap_alloc_record(2);
  yap_record_set(&v11, "head", v3);
  yap_record_set(&v11, "tail", v10);
  YapValue v12 = yap_alloc_record(2);
  yap_record_set(&v12, "__tag", v2);
  yap_record_set(&v12, "payload", v11);
  YapValue v13 = yap_alloc_record(2);
  yap_record_set(&v13, "head", v1);
  yap_record_set(&v13, "tail", v12);
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

## descending (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("cons");
  YapValue v1 = yap_num(3);
  YapValue v2 = yap_atom("cons");
  YapValue v3 = yap_num(2);
  YapValue v4 = yap_atom("cons");
  YapValue v5 = yap_num(1);
  YapValue v6 = yap_atom("nil");
  YapValue v7 = yap_null();
  YapValue v8 = yap_alloc_record(2);
  yap_record_set(&v8, "__tag", v6);
  yap_record_set(&v8, "payload", v7);
  YapValue v9 = yap_alloc_record(2);
  yap_record_set(&v9, "head", v5);
  yap_record_set(&v9, "tail", v8);
  YapValue v10 = yap_alloc_record(2);
  yap_record_set(&v10, "__tag", v4);
  yap_record_set(&v10, "payload", v9);
  YapValue v11 = yap_alloc_record(2);
  yap_record_set(&v11, "head", v3);
  yap_record_set(&v11, "tail", v10);
  YapValue v12 = yap_alloc_record(2);
  yap_record_set(&v12, "__tag", v2);
  yap_record_set(&v12, "payload", v11);
  YapValue v13 = yap_alloc_record(2);
  yap_record_set(&v13, "head", v1);
  yap_record_set(&v13, "tail", v12);
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

## getName (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_20(YapValue* __args, int __argc);

static YapValue closure_19(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_19, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_20(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue obj1 = __args[1];
  YapValue v0 = yap_record_get(obj1, "name");
  return v0;
}

static YapValue closure_19(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue r1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_20, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## person (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_str("Alice");
  YapValue v1 = yap_num(30);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "name", v0);
  yap_record_set(&v2, "age", v1);
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

## book (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_str("1984");
  YapValue v1 = yap_str("Orwell");
  YapValue v2 = yap_num(328);
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "name", v0);
  yap_record_set(&v3, "author", v1);
  yap_record_set(&v3, "pages", v2);
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

## n1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = getName;
  YapValue v1 = yap_atom("Num");
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "age", v1);
  YapValue fnref3 = yap_record_get(v0, "__fn");
  YapValue env4 = yap_record_get(v0, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, v2}, 2);
  YapValue v6 = person;
  YapValue fnref7 = yap_record_get(v5, "__fn");
  YapValue env8 = yap_record_get(v5, "__env");
  YapValue v9 = yap_call_closure(fnref7, (YapValue[]){env8, v6}, 2);
  return v9;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## n2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = getName;
  YapValue v1 = yap_atom("String");
  YapValue v2 = yap_atom("Num");
  YapValue v3 = yap_alloc_record(2);
  yap_record_set(&v3, "author", v1);
  yap_record_set(&v3, "pages", v2);
  YapValue fnref4 = yap_record_get(v0, "__fn");
  YapValue env5 = yap_record_get(v0, "__env");
  YapValue v6 = yap_call_closure(fnref4, (YapValue[]){env5, v3}, 2);
  YapValue v7 = book;
  YapValue fnref8 = yap_record_get(v6, "__fn");
  YapValue env9 = yap_record_get(v6, "__env");
  YapValue v10 = yap_call_closure(fnref8, (YapValue[]){env9, v7}, 2);
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

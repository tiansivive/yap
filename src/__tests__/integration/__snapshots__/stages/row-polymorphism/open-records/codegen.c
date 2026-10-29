## getX (let)
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
  YapValue record1 = __args[1];
  YapValue v0 = yap_record_get(record1, "x");
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

## p1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = getX;
  YapValue v1 = yap_atom("Num");
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "y", v1);
  YapValue fnref3 = yap_record_get(v0, "__fn");
  YapValue env4 = yap_record_get(v0, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, v2}, 2);
  YapValue v6 = yap_num(10);
  YapValue v7 = yap_num(20);
  YapValue v8 = yap_alloc_record(2);
  yap_record_set(&v8, "x", v6);
  yap_record_set(&v8, "y", v7);
  YapValue fnref9 = yap_record_get(v5, "__fn");
  YapValue env10 = yap_record_get(v5, "__env");
  YapValue v11 = yap_call_closure(fnref9, (YapValue[]){env10, v8}, 2);
  return v11;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## p2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = getX;
  YapValue v1 = yap_atom("Num");
  YapValue v2 = yap_atom("Num");
  YapValue v3 = yap_alloc_record(2);
  yap_record_set(&v3, "y", v1);
  yap_record_set(&v3, "z", v2);
  YapValue fnref4 = yap_record_get(v0, "__fn");
  YapValue env5 = yap_record_get(v0, "__env");
  YapValue v6 = yap_call_closure(fnref4, (YapValue[]){env5, v3}, 2);
  YapValue v7 = yap_num(5);
  YapValue v8 = yap_num(3);
  YapValue v9 = yap_num(7);
  YapValue v10 = yap_alloc_record(3);
  yap_record_set(&v10, "x", v7);
  yap_record_set(&v10, "y", v8);
  yap_record_set(&v10, "z", v9);
  YapValue fnref11 = yap_record_get(v6, "__fn");
  YapValue env12 = yap_record_get(v6, "__env");
  YapValue v13 = yap_call_closure(fnref11, (YapValue[]){env12, v10}, 2);
  return v13;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## p3 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = getX;
  YapValue v1 = yap_atom("String");
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "name", v1);
  YapValue fnref3 = yap_record_get(v0, "__fn");
  YapValue env4 = yap_record_get(v0, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, v2}, 2);
  YapValue v6 = yap_num(100);
  YapValue v7 = yap_str("point");
  YapValue v8 = yap_alloc_record(2);
  yap_record_set(&v8, "x", v6);
  yap_record_set(&v8, "name", v7);
  YapValue fnref9 = yap_record_get(v5, "__fn");
  YapValue env10 = yap_record_get(v5, "__env");
  YapValue v11 = yap_call_closure(fnref9, (YapValue[]){env10, v8}, 2);
  return v11;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

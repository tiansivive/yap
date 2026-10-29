## addZ (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_25(YapValue* __args, int __argc);

static YapValue closure_24(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_24, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_25(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue rec1 = __args[1];
  YapValue v0 = yap_num(0);
  YapValue v1 = yap_record_copy_with(rec1, (YapField[]){{"z", v0}}, 1);
  return v1;
}

static YapValue closure_24(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue r1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_25, yap_null());
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
  YapValue v0 = addZ;
  YapValue v1 = yap_alloc_record(0);
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = yap_num(1);
  YapValue v6 = yap_num(2);
  YapValue v7 = yap_alloc_record(2);
  yap_record_set(&v7, "x", v5);
  yap_record_set(&v7, "y", v6);
  YapValue fnref8 = yap_record_get(v4, "__fn");
  YapValue env9 = yap_record_get(v4, "__env");
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

## p2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = addZ;
  YapValue v1 = yap_atom("String");
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "color", v1);
  YapValue fnref3 = yap_record_get(v0, "__fn");
  YapValue env4 = yap_record_get(v0, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, v2}, 2);
  YapValue v6 = yap_num(5);
  YapValue v7 = yap_num(10);
  YapValue v8 = yap_str("red");
  YapValue v9 = yap_alloc_record(3);
  yap_record_set(&v9, "x", v6);
  yap_record_set(&v9, "y", v7);
  yap_record_set(&v9, "color", v8);
  YapValue fnref10 = yap_record_get(v5, "__fn");
  YapValue env11 = yap_record_get(v5, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  return v12;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

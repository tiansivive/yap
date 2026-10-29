## checkNum (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_14(YapValue* __args, int __argc);

static YapValue closure_13(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_13, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_14(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  return x1;
}

static YapValue closure_13(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue p1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_14, yap_null());
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

## nat5 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue v0 = checkNum;
  YapValue env_cls3 = yap_alloc_record(0);
  YapValue fnref_cls3 = yap_mk_closure(&closure_18, yap_null());
  YapValue closure_cls3 = yap_alloc_record(2);
  yap_record_set(&closure_cls3, "__fn", fnref_cls3);
  yap_record_set(&closure_cls3, "__env", env_cls3);
  YapValue fnref4 = yap_record_get(v0, "__fn");
  YapValue env5 = yap_record_get(v0, "__env");
  YapValue v6 = yap_call_closure(fnref4, (YapValue[]){env5, closure_cls3}, 2);
  YapValue v7 = yap_num(5);
  YapValue fnref8 = yap_record_get(v6, "__fn");
  YapValue env9 = yap_record_get(v6, "__env");
  YapValue v10 = yap_call_closure(fnref8, (YapValue[]){env9, v7}, 2);
  return v10;
}

static YapValue closure_18(YapValue* __args, int __argc) {
  YapValue env1 = __args[0];
  YapValue n2 = __args[1];
  YapValue v1 = yap_num(0);
  YapValue v2 = yap_gte(n2, v1);
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

## block (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_19(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_19, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  YapValue f3 = closure_cls2;
  YapValue v4 = yap_num(1);
  YapValue fnref5 = yap_record_get(f3, "__fn");
  YapValue env6 = yap_record_get(f3, "__env");
  YapValue v7 = yap_call_closure(fnref5, (YapValue[]){env6, v4}, 2);
  return v7;
}

static YapValue closure_19(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue o1 = __args[1];
  YapValue v0 = yap_num(1);
  YapValue v1 = yap_add(o1, v0);
  return v1;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

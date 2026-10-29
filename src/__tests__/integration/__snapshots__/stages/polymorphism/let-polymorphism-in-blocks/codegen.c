## letpoly (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_26(YapValue* __args, int __argc);

static YapValue closure_25(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_25, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  YapValue innerID3 = closure_cls2;
  YapValue v4 = yap_atom("Num");
  YapValue fnref5 = yap_record_get(innerID3, "__fn");
  YapValue env6 = yap_record_get(innerID3, "__env");
  YapValue v7 = yap_call_closure(fnref5, (YapValue[]){env6, v4}, 2);
  YapValue v8 = yap_num(42);
  YapValue fnref9 = yap_record_get(v7, "__fn");
  YapValue env10 = yap_record_get(v7, "__env");
  YapValue v11 = yap_call_closure(fnref9, (YapValue[]){env10, v8}, 2);
  YapValue n12 = v11;
  YapValue v13 = yap_atom("String");
  YapValue fnref14 = yap_record_get(innerID3, "__fn");
  YapValue env15 = yap_record_get(innerID3, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, v13}, 2);
  YapValue v17 = yap_str("hi");
  YapValue fnref18 = yap_record_get(v16, "__fn");
  YapValue env19 = yap_record_get(v16, "__env");
  YapValue v20 = yap_call_closure(fnref18, (YapValue[]){env19, v17}, 2);
  YapValue s21 = v20;
  return n12;
}

static YapValue closure_26(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  return x1;
}

static YapValue closure_25(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_26, yap_null());
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

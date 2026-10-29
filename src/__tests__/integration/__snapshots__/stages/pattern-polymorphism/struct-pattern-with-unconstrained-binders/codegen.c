## (expr) (expression)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_43(YapValue* __args, int __argc);

static YapValue closure_42(YapValue* __args, int __argc);

static YapValue closure_41(YapValue* __args, int __argc);

static YapValue closure_40(YapValue* __args, int __argc);

static YapValue closure_39(YapValue* __args, int __argc);

static YapValue closure_38(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_38, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_43(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  YapValue v0 = yap_record_get(x1, "bar");
  YapValue z = v0;
  YapValue v1 = yap_record_get(x1, "foo");
  YapValue y = v1;
  YapValue v2 = yap_num(0);
  return v2;
}

static YapValue closure_42(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue B1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_43, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_41(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", cap_0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_42, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_40(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue A1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", A1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_41, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_39(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_40, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_38(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue r1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_39, yap_null());
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

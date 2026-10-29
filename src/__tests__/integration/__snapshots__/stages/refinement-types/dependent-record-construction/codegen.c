## test (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_40(YapValue* __args, int __argc);

static YapValue closure_39(YapValue* __args, int __argc);

static YapValue closure_38(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_38, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  YapValue Pair3 = closure_cls2;
  YapValue v4 = yap_num(1);
  YapValue v5 = yap_num(2);
  YapValue v6 = yap_alloc_record(2);
  yap_record_set(&v6, "fst", v4);
  yap_record_set(&v6, "snd", v5);
  YapValue p7 = v6;
  YapValue v8 = yap_null();
  return v8;
}

static YapValue closure_40(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue p1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue v0 = yap_alloc_record(0);
  return v0;
}

static YapValue closure_39(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", b1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_40, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_38(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", a1);
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

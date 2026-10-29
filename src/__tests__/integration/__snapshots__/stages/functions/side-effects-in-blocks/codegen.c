## print (foreign)


## stringify (foreign)


## debug (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_34(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", result);
  YapValue fnref_cls2 = yap_mk_closure(&closure_34, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_34(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_str("Computing...");
  YapValue v1 = print(v0);
  YapValue v2 = yap_num(2);
  YapValue v3 = yap_mul(x1, v2);
  YapValue result4 = v3;
  YapValue v6 = stringify(v5, result4);
  YapValue v7 = print(v6);
  return result4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

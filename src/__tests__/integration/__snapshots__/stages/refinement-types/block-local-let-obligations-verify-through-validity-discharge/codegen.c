## compute (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_24(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", doubled);
  yap_record_set(&env_cls2, "v1", added);
  YapValue fnref_cls2 = yap_mk_closure(&closure_24, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_24(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue v0 = yap_num(2);
  YapValue v1 = yap_mul(x1, v0);
  YapValue doubled2 = v1;
  YapValue v3 = yap_num(10);
  YapValue v4 = yap_add(doubled2, v3);
  YapValue added5 = v4;
  return added5;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

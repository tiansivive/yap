## Pair (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_27(YapValue* __args, int __argc);

static YapValue closure_26(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_26, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_27(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue p1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_alloc_record(0);
  return v0;
}

static YapValue closure_26(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", a1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_27, yap_null());
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

## exampleP1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_num(42);
  YapValue v1 = yap_str("hello");
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "fst", v0);
  yap_record_set(&v2, "snd", v1);
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

## exampleP2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_bool(1);
  YapValue v1 = yap_num(100);
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "fst", v0);
  yap_record_set(&v2, "snd", v1);
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

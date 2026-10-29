## stringify (foreign)


## Show (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_18(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", String);
  YapValue fnref_cls2 = yap_mk_closure(&closure_18, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_18(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_alloc_record(0);
  return v0;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## Eq (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_20(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(1);
  yap_record_set(&env_cls2, "v0", Bool);
  YapValue fnref_cls2 = yap_mk_closure(&closure_20, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_20(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue t1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue v0 = yap_alloc_record(0);
  return v0;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## ShowNum (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue pap_fn1(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("Num");
  YapValue env_cls1 = yap_alloc_record(1);
  yap_record_set(&env_cls1, "v0", v0);
  YapValue fnref_cls1 = yap_mk_closure(&pap_fn1, yap_null());
  YapValue closure_cls1 = yap_alloc_record(2);
  yap_record_set(&closure_cls1, "__fn", fnref_cls1);
  yap_record_set(&closure_cls1, "__env", env_cls1);
  YapValue v2 = yap_alloc_record(1);
  yap_record_set(&v2, "show", closure_cls1);
  return v2;
}

static YapValue pap_fn1(YapValue* __args, int __argc) {
  YapValue env2 = __args[0];
  YapValue arg3 = __args[1];
  YapValue cap_0 = yap_record_get(env2, "v0");
  YapValue result_pap_fn1 = stringify(cap_0, arg3);
  return result_pap_fn1;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## ShowBool (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_19(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_19, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  YapValue v3 = yap_alloc_record(1);
  yap_record_set(&v3, "show", closure_cls2);
  return v3;
}

static YapValue closure_19(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  int yap_pc = 0;
  YapValue match0;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    if (yap_streq(yap_to_str(b1), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(b1), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v4 = yap_str("true");
    YapValue __t0 = v4;
    match0 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v5 = yap_str("false");
    YapValue __t0 = v5;
    match0 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match0;
  }
}
}
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## EqNum (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_mk_closure(&unknown, yap_null());
  YapValue v1 = yap_alloc_record(1);
  yap_record_set(&v1, "eq", v0);
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

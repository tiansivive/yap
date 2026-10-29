## makeType (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_19(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", Num);
  yap_record_set(&env_cls2, "v1", String);
  YapValue fnref_cls2 = yap_mk_closure(&closure_19, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_19(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  int yap_pc = 0;
  YapValue match0;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue cap_0 = yap_record_get(env0, "v0");
    YapValue cap_1 = yap_record_get(env0, "v1");
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
    YapValue __t0 = cap_0;
    match0 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue __t0 = cap_1;
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

## T1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = makeType;
  YapValue v1 = yap_bool(1);
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  return v4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## T2 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = makeType;
  YapValue v1 = yap_bool(0);
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  return v4;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

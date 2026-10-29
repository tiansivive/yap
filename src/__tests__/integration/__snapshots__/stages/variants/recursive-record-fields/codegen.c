## Factorial (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
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

## fact (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_33(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue v0 = yap_alloc_record(0);
  YapValue env_cls3 = yap_alloc_record(1);
  yap_record_set(&env_cls3, "v0", v0);
  YapValue fnref_cls3 = yap_mk_closure(&closure_33, yap_null());
  YapValue closure_cls3 = yap_alloc_record(2);
  yap_record_set(&closure_cls3, "__fn", fnref_cls3);
  yap_record_set(&closure_cls3, "__env", env_cls3);
  yap_record_set(&v0, "compute", closure_cls3);
  return v0;
}

static YapValue closure_33(YapValue* __args, int __argc) {
  YapValue env1 = __args[0];
  YapValue n2 = __args[1];
  int yap_pc = 0;
  YapValue match1;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue cap_0 = yap_record_get(env1, "v0");
    yap_pc = 1;
    break;
  }
  case 1: {
    if (yap_streq(yap_to_str(n2), "0")) {
  yap_pc = 2;
  break;
}
    {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v5 = yap_num(1);
    YapValue __t0 = v5;
    match1 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v6 = yap_record_get(cap_0, "compute");
    YapValue v7 = yap_num(1);
    YapValue v8 = yap_sub(n2, v7);
    YapValue fnref9 = yap_record_get(v6, "__fn");
    YapValue env10 = yap_record_get(v6, "__env");
    YapValue v11 = yap_call_closure(fnref9, (YapValue[]){env10, v8}, 2);
    YapValue v12 = yap_mul(n2, v11);
    YapValue __t0 = v12;
    match1 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match1;
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

## result (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = fact;
  YapValue v1 = yap_record_get(v0, "compute");
  YapValue v2 = yap_num(5);
  YapValue fnref3 = yap_record_get(v1, "__fn");
  YapValue env4 = yap_record_get(v1, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, v2}, 2);
  return v5;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

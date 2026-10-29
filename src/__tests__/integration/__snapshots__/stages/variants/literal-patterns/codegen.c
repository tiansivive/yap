## isZero (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_17(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_17, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_17(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue n1 = __args[1];
  int yap_pc = 0;
  YapValue match0;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    if (yap_streq(yap_to_str(n1), "0")) {
  yap_pc = 2;
  break;
}
    {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v4 = yap_bool(1);
    YapValue __t0 = v4;
    match0 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v5 = yap_bool(0);
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

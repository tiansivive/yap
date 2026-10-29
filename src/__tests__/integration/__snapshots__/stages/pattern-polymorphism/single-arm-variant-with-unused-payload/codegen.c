## (expr) (expression)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_31(YapValue* __args, int __argc);

static YapValue closure_30(YapValue* __args, int __argc);

static YapValue closure_29(YapValue* __args, int __argc);

static YapValue closure_28(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_28, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_31(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue x1 = __args[1];
  int yap_pc = 0;
  YapValue match1;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue tag0 = yap_record_get(x1, "__tag");
    if (yap_streq(yap_to_str(tag0), "nil")) {
  yap_pc = 2;
  break;
}
  }
  case 2: {
    YapValue v5 = yap_record_get(x1, "payload");
    YapValue a = v5;
    YapValue v6 = yap_num(0);
    YapValue __t0 = v6;
    match1 = __t0;
    yap_pc = 3;
    break;
  }
  case 3: {
    return match1;
  }
}
}
}

static YapValue closure_30(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue A1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_31, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_29(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_30, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_28(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue r1 = __args[1];
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_29, yap_null());
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

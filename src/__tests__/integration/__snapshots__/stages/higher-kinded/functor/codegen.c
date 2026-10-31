## List (let)
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

## Functor (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_31(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_31, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_31(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
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

## mapList (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_63(YapValue* __args, int __argc);

static YapValue closure_62(YapValue* __args, int __argc);

static YapValue closure_61(YapValue* __args, int __argc);

static YapValue closure_60(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", List);
  yap_record_set(&env_cls2, "v1", mapList);
  YapValue fnref_cls2 = yap_mk_closure(&closure_60, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_63(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue list1 = __args[1];
  int yap_pc = 0;
  YapValue match1;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue cap_0 = yap_record_get(env0, "v0");
    YapValue cap_1 = yap_record_get(env0, "v1");
    YapValue cap_2 = yap_record_get(env0, "v2");
    YapValue cap_3 = yap_record_get(env0, "v3");
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue tag0 = yap_record_get(list1, "__tag");
    if (yap_streq(yap_to_str(tag0), "nil")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(tag0), "cons")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v5 = yap_atom("nil");
    YapValue v6 = yap_null();
    YapValue v7 = yap_alloc_record(2);
    yap_record_set(&v7, "__tag", v5);
    yap_record_set(&v7, "payload", v6);
    YapValue __t0 = v7;
    match1 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v6 = yap_record_get(list1, "payload");
    YapValue v7 = yap_record_get(v6, "0");
    YapValue x = v7;
    YapValue v8 = yap_record_get(v6, "1");
    YapValue xs = v8;
    YapValue v9 = yap_atom("cons");
    YapValue fnref10 = yap_record_get(cap_0, "__fn");
    YapValue env11 = yap_record_get(cap_0, "__env");
    YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, x}, 2);
    YapValue fnref13 = yap_record_get(cap_1, "__fn");
    YapValue env14 = yap_record_get(cap_1, "__env");
    YapValue v15 = yap_call_closure(fnref13, (YapValue[]){env14, cap_2}, 2);
    YapValue fnref16 = yap_record_get(v15, "__fn");
    YapValue env17 = yap_record_get(v15, "__env");
    YapValue v18 = yap_call_closure(fnref16, (YapValue[]){env17, cap_3}, 2);
    YapValue fnref19 = yap_record_get(v18, "__fn");
    YapValue env20 = yap_record_get(v18, "__env");
    YapValue v21 = yap_call_closure(fnref19, (YapValue[]){env20, cap_0}, 2);
    YapValue fnref22 = yap_record_get(v21, "__fn");
    YapValue env23 = yap_record_get(v21, "__env");
    YapValue v24 = yap_call_closure(fnref22, (YapValue[]){env23, xs}, 2);
    YapValue v25 = yap_alloc_record(2);
    yap_record_set(&v25, "0", v12);
    yap_record_set(&v25, "1", v24);
    YapValue v26 = yap_alloc_record(2);
    yap_record_set(&v26, "__tag", v9);
    yap_record_set(&v26, "payload", v25);
    YapValue __t0 = v26;
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

static YapValue closure_62(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  YapValue cap_3 = yap_record_get(env0, "v3");
  YapValue env_cls2 = yap_alloc_record(4);
  yap_record_set(&env_cls2, "v0", f1);
  yap_record_set(&env_cls2, "v1", cap_2);
  yap_record_set(&env_cls2, "v2", cap_1);
  yap_record_set(&env_cls2, "v3", cap_3);
  YapValue fnref_cls2 = yap_mk_closure(&closure_63, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_61(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue b1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  YapValue env_cls2 = yap_alloc_record(4);
  yap_record_set(&env_cls2, "v0", cap_1);
  yap_record_set(&env_cls2, "v1", cap_0);
  yap_record_set(&env_cls2, "v2", cap_2);
  yap_record_set(&env_cls2, "v3", b1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_62, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_60(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", a1);
  yap_record_set(&env_cls2, "v1", cap_0);
  yap_record_set(&env_cls2, "v2", cap_1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_61, yap_null());
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

## ListFunctor (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = mapList;
  YapValue v1 = yap_alloc_record(1);
  yap_record_set(&v1, "map", v0);
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

## stringify (foreign)


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

## fmap (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_39(YapValue* __args, int __argc);

static YapValue closure_38(YapValue* __args, int __argc);

static YapValue closure_37(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", Functor);
  yap_record_set(&env_cls2, "v1", cap1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_37, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_39(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  return cap_0;
}

static YapValue closure_38(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue functor1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", cap_1);
  yap_record_set(&env_cls2, "v2", functor1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_39, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_37(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue f1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", cap_1);
  yap_record_set(&env_cls2, "v1", f1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_38, yap_null());
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

## (using) (using)


## strmap (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue pap_fn13(YapValue* __args, int __argc);

static YapValue closure_36(YapValue* __args, int __argc);

static YapValue closure_35(YapValue* __args, int __argc);

static YapValue closure_34(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(2);
  yap_record_set(&env_cls2, "v0", Functor);
  yap_record_set(&env_cls2, "v1", fmap);
  YapValue fnref_cls2 = yap_mk_closure(&closure_34, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue pap_fn13(YapValue* __args, int __argc) {
  YapValue env14 = __args[0];
  YapValue arg15 = __args[1];
  YapValue cap_0 = yap_record_get(env14, "v0");
  YapValue result_pap_fn13 = stringify(cap_0, arg15);
  return result_pap_fn13;
}

static YapValue closure_36(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue A1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  YapValue fnref0 = yap_record_get(cap_0, "__fn");
  YapValue env1 = yap_record_get(cap_0, "__env");
  YapValue v2 = yap_call_closure(fnref0, (YapValue[]){env1, cap_1}, 2);
  YapValue fnref3 = yap_record_get(v2, "__fn");
  YapValue env4 = yap_record_get(v2, "__env");
  YapValue v5 = yap_call_closure(fnref3, (YapValue[]){env4, A1}, 2);
  YapValue fnref6 = yap_record_get(v5, "__fn");
  YapValue env7 = yap_record_get(v5, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, cap_2}, 2);
  YapValue v9 = yap_atom("String");
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  YapValue env_cls13 = yap_alloc_record(1);
  yap_record_set(&env_cls13, "v0", cap_2);
  YapValue fnref_cls13 = yap_mk_closure(&pap_fn13, yap_null());
  YapValue closure_cls13 = yap_alloc_record(2);
  yap_record_set(&closure_cls13, "__fn", fnref_cls13);
  yap_record_set(&closure_cls13, "__env", env_cls13);
  YapValue fnref14 = yap_record_get(v12, "__fn");
  YapValue env15 = yap_record_get(v12, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, closure_cls13}, 2);
  return v16;
}

static YapValue closure_35(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue a1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue cap_2 = yap_record_get(env0, "v2");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_2);
  yap_record_set(&env_cls2, "v1", cap_1);
  yap_record_set(&env_cls2, "v2", a1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_36, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_34(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue F1 = __args[1];
  YapValue cap_0 = yap_record_get(env0, "v0");
  YapValue cap_1 = yap_record_get(env0, "v1");
  YapValue env_cls2 = yap_alloc_record(3);
  yap_record_set(&env_cls2, "v0", cap_0);
  yap_record_set(&env_cls2, "v1", F1);
  yap_record_set(&env_cls2, "v2", cap_1);
  YapValue fnref_cls2 = yap_mk_closure(&closure_35, yap_null());
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

## listOf1 (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("cons");
  YapValue v1 = yap_num(1);
  YapValue v2 = yap_atom("nil");
  YapValue v3 = yap_null();
  YapValue v4 = yap_alloc_record(2);
  yap_record_set(&v4, "__tag", v2);
  yap_record_set(&v4, "payload", v3);
  YapValue v5 = yap_alloc_record(2);
  yap_record_set(&v5, "0", v1);
  yap_record_set(&v5, "1", v4);
  YapValue v6 = yap_alloc_record(2);
  yap_record_set(&v6, "__tag", v0);
  yap_record_set(&v6, "payload", v5);
  return v6;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## strList (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = strmap;
  YapValue v1 = List;
  YapValue fnref2 = yap_record_get(v0, "__fn");
  YapValue env3 = yap_record_get(v0, "__env");
  YapValue v4 = yap_call_closure(fnref2, (YapValue[]){env3, v1}, 2);
  YapValue v5 = yap_atom("Num");
  YapValue fnref6 = yap_record_get(v4, "__fn");
  YapValue env7 = yap_record_get(v4, "__env");
  YapValue v8 = yap_call_closure(fnref6, (YapValue[]){env7, v5}, 2);
  YapValue v9 = ListFunctor;
  YapValue fnref10 = yap_record_get(v8, "__fn");
  YapValue env11 = yap_record_get(v8, "__env");
  YapValue v12 = yap_call_closure(fnref10, (YapValue[]){env11, v9}, 2);
  YapValue v13 = listOf1;
  YapValue fnref14 = yap_record_get(v12, "__fn");
  YapValue env15 = yap_record_get(v12, "__env");
  YapValue v16 = yap_call_closure(fnref14, (YapValue[]){env15, v13}, 2);
  return v16;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

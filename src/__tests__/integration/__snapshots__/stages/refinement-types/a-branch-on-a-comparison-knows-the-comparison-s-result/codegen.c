## abs (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_29(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_29, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_29(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue n1 = __args[1];
  int yap_pc = 0;
  YapValue match2;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue v0 = yap_num(0);
    YapValue v1 = yap_lte(v0, n1);
    if (yap_streq(yap_to_str(v1), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(v1), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue __t0 = n1;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v7 = yap_num(0);
    YapValue v8 = yap_sub(v7, n1);
    YapValue __t0 = v8;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match2;
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

## absNegatesBoth (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_34(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_34, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_34(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue n1 = __args[1];
  int yap_pc = 0;
  YapValue match2;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue v0 = yap_num(0);
    YapValue v1 = yap_lte(v0, n1);
    if (yap_streq(yap_to_str(v1), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(v1), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue v6 = yap_num(0);
    YapValue v7 = yap_sub(v6, n1);
    YapValue __t0 = v7;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v7 = yap_num(0);
    YapValue v8 = yap_sub(v7, n1);
    YapValue __t0 = v8;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match2;
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

## absKeepsBoth (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue closure_23(YapValue* __args, int __argc);

static YapValue yap_main(void) {
  YapValue env_cls2 = yap_alloc_record(0);
  YapValue fnref_cls2 = yap_mk_closure(&closure_23, yap_null());
  YapValue closure_cls2 = yap_alloc_record(2);
  yap_record_set(&closure_cls2, "__fn", fnref_cls2);
  yap_record_set(&closure_cls2, "__env", env_cls2);
  return closure_cls2;
}

static YapValue closure_23(YapValue* __args, int __argc) {
  YapValue env0 = __args[0];
  YapValue n1 = __args[1];
  int yap_pc = 0;
  YapValue match2;
  while (1) {
  switch (yap_pc) {
  case 0: {
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue v0 = yap_num(0);
    YapValue v1 = yap_lte(v0, n1);
    if (yap_streq(yap_to_str(v1), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(v1), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue __t0 = n1;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue __t0 = n1;
    match2 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match2;
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

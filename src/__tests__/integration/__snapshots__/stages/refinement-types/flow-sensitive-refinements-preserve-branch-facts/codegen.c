## test (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  int yap_pc = 0;
  YapValue match4;
  while (1) {
  switch (yap_pc) {
  case 0: {
    YapValue b9 = match4;
    YapValue v10 = yap_num(1);
    yap_pc = 1;
    break;
  }
  case 1: {
    YapValue v0 = yap_num(1);
    YapValue a1 = v0;
    YapValue v2 = yap_num(0);
    YapValue v3 = yap_gt(a1, v2);
    if (yap_streq(yap_to_str(v3), "true")) {
  yap_pc = 2;
  break;
}
    if (yap_streq(yap_to_str(v3), "false")) {
  yap_pc = 3;
  break;
}
  }
  case 2: {
    YapValue __t0 = a1;
    match4 = __t0;
    yap_pc = 4;
    break;
  }
  case 3: {
    YapValue v9 = yap_num(42);
    YapValue __t0 = v9;
    match4 = __t0;
    yap_pc = 4;
    break;
  }
  case 4: {
    return match4;
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

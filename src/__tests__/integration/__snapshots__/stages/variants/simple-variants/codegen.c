## TrafficLight (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("Unit");
  YapValue v1 = yap_atom("Unit");
  YapValue v2 = yap_atom("Unit");
  YapValue v3 = yap_alloc_record(3);
  yap_record_set(&v3, "green", v0);
  yap_record_set(&v3, "yellow", v1);
  yap_record_set(&v3, "red", v2);
  return v3;
}

int main(void) {
  yap_arena_init();
  YapValue __result = yap_main();
  yap_print_value(__result);
  printf("\n");
  yap_arena_free();
  return 0;
}

## light (let)
#include "rt/yap.h"

static YapValue yap_main(void);

static YapValue yap_main(void) {
  YapValue v0 = yap_atom("red");
  YapValue v1 = yap_null();
  YapValue v2 = yap_alloc_record(2);
  yap_record_set(&v2, "__tag", v0);
  yap_record_set(&v2, "payload", v1);
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

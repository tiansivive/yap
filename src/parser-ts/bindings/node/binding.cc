#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_yap();

// "tree_sitter_yap_binding" is the name of the target in binding.gyp
namespace {

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports["name"] = Napi::String::New(env, "yap");
  auto language = Napi::External<TSLanguage>::New(env, tree_sitter_yap());
  exports["language"] = language;
  return exports;
}

NODE_API_MODULE(tree_sitter_yap_binding, Init)

}  // namespace

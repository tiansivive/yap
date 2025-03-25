import "./functor.yap";

let List
    : Type -> Type
    = \a -> | #nil Unit | #cons { a, List a };

let ListF
    : Functor List
    = { map: \f -> \l -> match l
        | #nil _            -> #nil *
        | #cons { x, xs }   -> #cons { f x, :map f xs } 
      };

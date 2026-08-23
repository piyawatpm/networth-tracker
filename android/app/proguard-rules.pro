# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.piyawatpm.vesta.**$$serializer { *; }
-keepclassmembers class com.piyawatpm.vesta.** { *** Companion; }
-keepclasseswithmembers class com.piyawatpm.vesta.** { kotlinx.serialization.KSerializer serializer(...); }

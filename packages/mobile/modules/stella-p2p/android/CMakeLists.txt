cmake_minimum_required(VERSION 3.22)
project(stella_p2p_jni CXX)

# libstella_p2p.so comes from scripts/stella-p2p.sh (vendor/jniLibs/<abi>/), the header with it.
set(VENDOR ${CMAKE_CURRENT_SOURCE_DIR}/vendor)

add_library(stella_p2p SHARED IMPORTED)
set_target_properties(stella_p2p PROPERTIES IMPORTED_LOCATION ${VENDOR}/jniLibs/${ANDROID_ABI}/libstella_p2p.so)

add_library(stella_p2p_jni SHARED src/main/cpp/stella_p2p_jni.cpp)
target_include_directories(stella_p2p_jni PRIVATE ${VENDOR})
target_compile_features(stella_p2p_jni PRIVATE cxx_std_17)
# 16 KB pages (Android 15+).
target_link_options(stella_p2p_jni PRIVATE -Wl,-z,max-page-size=16384)
target_link_libraries(stella_p2p_jni stella_p2p android log)

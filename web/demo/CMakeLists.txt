cmake_minimum_required(VERSION 3.13)

project(Displaylist)

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 17)

if (NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Release")
endif ()

set(CMAKE_POLICY_DEFAULT_CMP0077 NEW)
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../src)

if (NOT TGFX_DIR)
    set(TGFX_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/tgfx)
else ()
    get_filename_component(TGFX_DIR "${TGFX_DIR}" REALPATH BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    message("Custom TGFX_DIR: ${TGFX_DIR}")
endif ()
add_subdirectory(${TGFX_DIR} ./tgfx)

file(GLOB_RECURSE DISPLAYLIST_FILES
        ../../src/*.*
        src/*.*)

if (DEFINED EMSCRIPTEN)
    add_executable(displaylist ${DISPLAYLIST_FILES})
    list(APPEND DISPLAYLIST_COMPILE_OPTIONS -fno-rtti -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0)
    list(APPEND DISPLAYLIST_LINK_OPTIONS --no-entry -lembind -fno-rtti -DEMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0 -sEXPORT_NAME='Displaylist' -sWASM=1 -sASYNCIFY
            -sMAX_WEBGL_VERSION=2 -sEXPORTED_RUNTIME_METHODS=['GL','Asyncify','HEAPU8'] -sMODULARIZE=1
            -sENVIRONMENT=web,worker -sEXPORT_ES6=1 -std=c++17)
    if (EMSCRIPTEN_PTHREADS)
        list(APPEND DISPLAYLIST_LINK_OPTIONS -sUSE_PTHREADS=1 -sINITIAL_MEMORY=32MB -sALLOW_MEMORY_GROWTH=1
                -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency -sPROXY_TO_PTHREAD=1
                -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 -sMALLOC=mimalloc)
        list(APPEND DISPLAYLIST_COMPILE_OPTIONS -fPIC -pthread)
    else ()
        list(APPEND DISPLAYLIST_LINK_OPTIONS -sALLOW_MEMORY_GROWTH=1)
    endif ()
    if (CMAKE_BUILD_TYPE STREQUAL "Debug")
        list(APPEND DISPLAYLIST_COMPILE_OPTIONS -O0 -g3)
        list(APPEND DISPLAYLIST_LINK_OPTIONS -O0 -g3 -sSAFE_HEAP=1 -Wno-limited-postlink-optimizations)
    else ()
        list(APPEND DISPLAYLIST_COMPILE_OPTIONS -Oz)
        list(APPEND DISPLAYLIST_LINK_OPTIONS -Oz)
    endif ()
else ()
    add_library(displaylist SHARED ${DISPLAYLIST_FILES})
endif ()

target_compile_options(displaylist PUBLIC ${DISPLAYLIST_COMPILE_OPTIONS})
target_link_options(displaylist PUBLIC ${DISPLAYLIST_LINK_OPTIONS})
target_link_libraries(displaylist tgfx)

cmake_minimum_required(VERSION 3.18)
project(agent_kernel LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

find_package(Python3 REQUIRED COMPONENTS Interpreter Development)
find_package(pybind11 REQUIRED)

add_library(agent_kernel_core STATIC
    src/metrics.cpp
    src/process.cpp
    src/fs_watcher.cpp
    src/sandbox.cpp
)

target_include_directories(agent_kernel_core PUBLIC include)
target_compile_options(agent_kernel_core PRIVATE -Wall -Wextra -O2)

pybind11_add_module(agent_kernel bindings/module.cpp)
target_link_libraries(agent_kernel PRIVATE agent_kernel_core)

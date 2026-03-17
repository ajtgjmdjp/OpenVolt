cmake_minimum_required(VERSION 3.20)
project(OpenVolt
    VERSION 0.1.0
    LANGUAGES CXX
    DESCRIPTION "Professional-grade portfolio optimization engine"
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Dependencies
find_package(Eigen3 REQUIRED)
find_package(osqp REQUIRED)

# Core library
add_library(openvolt_core STATIC
    core/models/position.cpp
    core/models/trade.cpp
    core/risk/covariance.cpp
    core/portfolio/portfolio.cpp
    core/optimizer/quadratic.cpp
    core/optimizer/osqp_solver.cpp
    core/models/tax_policy.cpp
    core/simulation/engine.cpp
    core/simulation/rolling_backtest.cpp
    workflows/direct_index.cpp
    api.cpp
)
target_include_directories(openvolt_core PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(openvolt_core PUBLIC Eigen3::Eigen osqp::osqp)

# Python bindings
option(OPENVOLT_BUILD_PYTHON "Build Python bindings" OFF)
if(OPENVOLT_BUILD_PYTHON)
    find_package(pybind11 REQUIRED)
    pybind11_add_module(_openvolt python/bindings.cpp)
    target_link_libraries(_openvolt PRIVATE openvolt_core)
endif()

# Tests
option(OPENVOLT_BUILD_TESTS "Build tests" ON)
if(OPENVOLT_BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

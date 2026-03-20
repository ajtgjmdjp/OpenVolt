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

# SCS (optional — enable if found)
option(OPENVOLT_WITH_SCS "Build with SCS solver" ON)
if(OPENVOLT_WITH_SCS)
    find_library(SCS_LIB NAMES scsdir PATHS /opt/homebrew/lib /usr/local/lib /usr/lib)
    find_path(SCS_INCLUDE scs/scs.h PATHS /opt/homebrew/include /usr/local/include /usr/include)
    if(SCS_LIB AND SCS_INCLUDE)
        message(STATUS "SCS found: ${SCS_LIB}")
        set(HAS_SCS TRUE)
    else()
        message(STATUS "SCS not found — building without SCS solver")
        set(HAS_SCS FALSE)
    endif()
endif()

# Core library
set(CORE_SOURCES
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
if(HAS_SCS)
    list(APPEND CORE_SOURCES core/optimizer/scs_solver.cpp)
endif()

add_library(openvolt_core STATIC ${CORE_SOURCES})
target_include_directories(openvolt_core PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(openvolt_core PUBLIC Eigen3::Eigen osqp::osqp)

if(HAS_SCS)
    target_include_directories(openvolt_core PUBLIC ${SCS_INCLUDE})
    target_link_libraries(openvolt_core PUBLIC ${SCS_LIB})
    target_compile_definitions(openvolt_core PUBLIC OPENVOLT_HAS_SCS=1)
endif()

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

#pragma once

#include <Eigen/Core>
#include <Eigen/Sparse>
#include <memory>
#include <string>

namespace openvolt {

using SpMat = Eigen::SparseMatrix<double>;
using Vec = Eigen::VectorXd;

/// A generic QP problem in canonical form:
///   min  0.5 x' P x + q' x
///   s.t. l <= A x <= u
struct QPProblem {
    SpMat P;   // n x n, upper triangular
    Vec q;     // n
    SpMat A;   // m x n
    Vec l;     // m
    Vec u;     // m
};

/// Solution returned by a QP solver.
struct QPSolution {
    Vec x;
    double objective = 0.0;
    int iterations = 0;
    bool solved = false;
    std::string status;
};

/// Abstract QP solver interface.
/// Allows swapping OSQP for Clarabel or other solvers.
class IQPSolver {
public:
    virtual ~IQPSolver() = default;
    virtual QPSolution solve(const QPProblem& problem) = 0;
    [[nodiscard]] virtual std::string name() const = 0;
};

/// Create the default OSQP-based solver.
[[nodiscard]] std::unique_ptr<IQPSolver> make_osqp_solver(
    double eps_abs = 1e-6,
    double eps_rel = 1e-6,
    int max_iter = 10000,
    bool verbose = false
);

} // namespace openvolt

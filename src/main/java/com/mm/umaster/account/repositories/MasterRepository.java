package com.mm.umaster.account.repositories;

import com.mm.umaster.account.models.Master;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MasterRepository extends JpaRepository<Master, Long> {
}

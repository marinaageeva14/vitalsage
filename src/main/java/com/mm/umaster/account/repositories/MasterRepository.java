package com.mm.umaster.account.repositories;

import com.mm.umaster.account.models.Master;
import org.springframework.data.domain.Example;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface MasterRepository extends JpaRepository<Master, Long> {

    Master findMasterByUser_Id(Long id);
  //  Master findMasterBySkil
}
